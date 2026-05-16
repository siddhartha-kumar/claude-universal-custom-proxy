FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GATEWAY_HOST=0.0.0.0 \
    GATEWAY_PORT=8080

WORKDIR /app

RUN addgroup --system gateway && adduser --system --ingroup gateway gateway

COPY pyproject.toml README.md LICENSE ./
COPY src ./src
COPY config ./config

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir .

USER gateway
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"

CMD ["uvicorn", "llm_proxy_gateway.main:app", "--host", "0.0.0.0", "--port", "8080"]
