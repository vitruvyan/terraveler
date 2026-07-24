"""Terraveler Embedding API — nomic text+vision, embed-only.

Reuses the exact nomic embedding engine from the Vitruvyan embedding service
(same model loading, same encode, same vision pooling with the pinned revision)
but strips ALL storage plumbing: no Qdrant, no Postgres agent, no auth. This
service only embeds; persistence to pgvector is the ingestion job's concern.

Text:  nomic-embed-text-v1.5   (768-d)
Vision: nomic-embed-vision-v1.5 (768-d, same latent space → cross-modal search)
"""
import os, io, time, base64, logging
from contextlib import asynccontextmanager
from typing import List, Optional

import torch
import torch.nn.functional as F
from PIL import Image
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from transformers import AutoProcessor, AutoModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("terraveler-embedding")

TEXT_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-ai/nomic-embed-text-v1.5")
VISION_MODEL = os.getenv("EMBEDDING_VISION_MODEL", "nomic-ai/nomic-embed-vision-v1.5")
VISION_REVISION = os.getenv("EMBEDDING_VISION_REVISION", "9e4269d0524e")
PORT = int(os.getenv("PORT", "8010"))


class EmbeddingEngine:
    def __init__(self):
        self.model: Optional[SentenceTransformer] = None
        self.vp = None   # AutoProcessor
        self.vm = None   # AutoModel

    def initialize(self) -> None:
        log.info(f"Loading text model: {TEXT_MODEL}")
        self.model = SentenceTransformer(
            TEXT_MODEL, trust_remote_code=True,
            tokenizer_kwargs={"trust_remote_code": True},
        )
        log.info(f"Loading vision model: {VISION_MODEL}@{VISION_REVISION}")
        self.vp = AutoProcessor.from_pretrained(
            VISION_MODEL, revision=VISION_REVISION, trust_remote_code=True)
        self.vm = AutoModel.from_pretrained(
            VISION_MODEL, revision=VISION_REVISION, trust_remote_code=True)
        self.vm.eval()
        log.info("Models ready")

    def embed_text(self, text: str) -> List[float]:
        return self.model.encode(text).tolist()

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        return self.model.encode(texts).tolist()

    @staticmethod
    def _decode(b64: str) -> Image.Image:
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")

    def _run_vision(self, images: List[Image.Image]) -> List[List[float]]:
        inputs = self.vp(images=images, return_tensors="pt")
        with torch.no_grad():
            out = self.vm(**inputs)
        if hasattr(out, "image_embeds"):
            emb = out.image_embeds
        elif getattr(out, "pooler_output", None) is not None:
            emb = out.pooler_output
        else:
            emb = out.last_hidden_state[:, 0, :]
        emb = F.normalize(emb, p=2, dim=-1)
        return emb.cpu().tolist()

    def embed_image(self, b64: str) -> List[float]:
        return self._run_vision([self._decode(b64)])[0]

    def embed_image_batch(self, b64s: List[str]) -> List[List[float]]:
        return self._run_vision([self._decode(b) for b in b64s])

    def dim(self) -> Optional[int]:
        return self.model.get_sentence_embedding_dimension() if self.model else None


engine = EmbeddingEngine()


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine.initialize()
    yield


app = FastAPI(title="Terraveler Embedding API", version="1.0.0", lifespan=lifespan)


class EmbReq(BaseModel):
    text: str = Field(..., description="Text to embed")
    model: Optional[str] = Field(TEXT_MODEL, description="(informational)")


class BatchReq(BaseModel):
    texts: List[str]


class ImgReq(BaseModel):
    image_b64: str
    metadata: Optional[dict] = None


class ImgBatchReq(BaseModel):
    images_b64: List[str]


class EmbResp(BaseModel):
    success: bool
    embedding: Optional[List[float]] = None
    embeddings: Optional[List[List[float]]] = None
    dimension: Optional[int] = None
    model_used: Optional[str] = None
    processing_time_ms: Optional[float] = None
    error: Optional[str] = None


@app.get("/health")
def health():
    ok = engine.model is not None and engine.vm is not None
    return {
        "status": "healthy" if ok else "unhealthy",
        "components": {
            "embedding_model": engine.model is not None,
            "vision_model": engine.vm is not None,
        },
        "model": TEXT_MODEL, "vision_model": VISION_MODEL, "dimension": engine.dim(),
    }


@app.get("/v1/stats")
def stats():
    return {"success": True,
            "model": {"name": TEXT_MODEL, "dimension": engine.dim()},
            "vision_model": {"name": VISION_MODEL}}


@app.post("/v1/embeddings/create", response_model=EmbResp)
def create(req: EmbReq):
    t0 = time.time()
    try:
        v = engine.embed_text(req.text)
        return EmbResp(success=True, embedding=v, dimension=len(v),
                       model_used=TEXT_MODEL, processing_time_ms=(time.time() - t0) * 1000)
    except Exception as e:
        return EmbResp(success=False, error=str(e))


@app.post("/v1/embeddings/batch", response_model=EmbResp)
def batch(req: BatchReq):
    t0 = time.time()
    try:
        vs = engine.embed_batch(req.texts)
        return EmbResp(success=True, embeddings=vs, dimension=len(vs[0]) if vs else 0,
                       model_used=TEXT_MODEL, processing_time_ms=(time.time() - t0) * 1000)
    except Exception as e:
        return EmbResp(success=False, error=str(e))


@app.post("/v1/embeddings/image", response_model=EmbResp)
def image(req: ImgReq):
    t0 = time.time()
    try:
        v = engine.embed_image(req.image_b64)
        return EmbResp(success=True, embedding=v, dimension=len(v),
                       model_used=VISION_MODEL, processing_time_ms=(time.time() - t0) * 1000)
    except Exception as e:
        return EmbResp(success=False, error=str(e))


@app.post("/v1/embeddings/image/batch", response_model=EmbResp)
def image_batch(req: ImgBatchReq):
    t0 = time.time()
    try:
        vs = engine.embed_image_batch(req.images_b64)
        return EmbResp(success=True, embeddings=vs, dimension=len(vs[0]) if vs else 0,
                       model_used=VISION_MODEL, processing_time_ms=(time.time() - t0) * 1000)
    except Exception as e:
        return EmbResp(success=False, error=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
