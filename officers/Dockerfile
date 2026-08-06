FROM python:3.12-slim

# ca-certificates: the Curator relocates quotations against live sources
# over HTTPS (scripts/desk_review.py -> ingest/verbatim.py).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# The kernel, as a versioned wheel — the officers are Motus graphs in the
# making (Ship's Officers §6), and this container could not import the
# kernel at all until it arrived as a package. Note that nothing here
# imports it yet: the Curator handler still shells out to
# scripts/desk_review.py. The officers never consumed the predecessor, so
# they are the one place that can be born native rather than on compat.
COPY wheels/ /tmp/wheels/
RUN pip install --no-cache-dir -r requirements.txt /tmp/wheels/vitruvyan_motus-*.whl \
 && rm -rf /tmp/wheels
COPY *.py .

# The watch holds a database credential and spawns a verifier over
# contributor-influenced remote content — it does not also get root.
RUN useradd --system --no-create-home officer
USER officer

CMD ["python", "main.py"]
