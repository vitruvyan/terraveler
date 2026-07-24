FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch (no CUDA) — keeps the image lean
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app /app/app

ENV PYTHONPATH=/app HF_HOME=/cache/hf PORT=8010

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
  CMD curl -f http://localhost:8010/health || exit 1

CMD ["python", "app/main.py"]
