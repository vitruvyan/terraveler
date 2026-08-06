FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
# The kernel arrives as a versioned wheel (scripts/fetch_motus_wheel.sh),
# not as a copied source tree — two vendored copies diverged once and the
# divergence cost a production audit trace. pip owns the resolution now.
COPY wheels/ /tmp/wheels/
RUN pip install --no-cache-dir -r requirements.txt /tmp/wheels/vitruvyan_motus-*.whl \
 && rm -rf /tmp/wheels
COPY *.py /app/
ENV PYTHONPATH=/app
ENTRYPOINT ["python", "run.py"]
