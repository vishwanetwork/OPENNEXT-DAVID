FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY spotbot ./spotbot
RUN pip install --no-cache-dir '.[mysql,dynamodb]' \
    && useradd -m -u 10001 spotbot \
    && useradd -m -u 10002 spotgateway \
    && mkdir /app/data /app/gateway-data \
    && chown spotbot:spotbot /app/data \
    && chown spotgateway:spotgateway /app/gateway-data
USER spotbot
EXPOSE 8000
CMD ["spotbot", "serve", "--host", "0.0.0.0", "--port", "8000"]
