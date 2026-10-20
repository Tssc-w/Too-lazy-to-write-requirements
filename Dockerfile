FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    IMAGEREQ_HOST=0.0.0.0

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --system --create-home --uid 10001 appuser

COPY app.py ./app.py
COPY web ./web
COPY templates ./templates

USER 10001:10001
EXPOSE 8766
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('IMAGEREQ_PORT', os.environ.get('PORT', '8766')) + '/healthz', timeout=3)"
CMD ["python", "app.py"]
