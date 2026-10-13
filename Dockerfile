FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY spotbot ./spotbot
RUN pip install --no-cache-dir '.[mysql,dynamodb]' && useradd -m -u 10001 spotbot && mkdir /app/data && chown spotbot:spotbot /app/data
USER spotbot
EXPOSE 8000
CMD ["spotbot", "serve", "--host", "0.0.0.0", "--port", "8000"]
