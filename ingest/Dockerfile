FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY axis /app/axis
COPY *.py /app/
ENV PYTHONPATH=/app
ENTRYPOINT ["python", "run.py"]
