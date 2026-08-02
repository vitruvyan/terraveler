FROM python:3.10-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
# Kernel as a versioned wheel (scripts/fetch_axis_wheel.sh) — see
# ingest/Dockerfile for why the source-tree copy died.
COPY wheels/ /tmp/wheels/
RUN pip install --no-cache-dir -r requirements.txt /tmp/wheels/vitruvyan_axis-*.whl \
 && rm -rf /tmp/wheels
COPY app /app/app
ENV PYTHONPATH=/app PORT=8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
