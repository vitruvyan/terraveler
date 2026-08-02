FROM python:3.12-slim

# ca-certificates: the Curator relocates quotations against live sources
# over HTTPS (scripts/desk_review.py -> ingest/verbatim.py).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py .

# The watch holds a database credential and spawns a verifier over
# contributor-influenced remote content — it does not also get root.
RUN useradd --system --no-create-home officer
USER officer

CMD ["python", "main.py"]
