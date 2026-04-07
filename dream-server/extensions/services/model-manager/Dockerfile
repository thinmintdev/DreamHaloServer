# Dream Server Model Manager
# Browse, download, and manage AI model files

FROM python:3.12-slim

LABEL org.opencontainers.image.source="https://github.com/Light-Heart-Labs/DreamServer"
LABEL org.opencontainers.image.description="Dream Server Model Manager"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Non-root user
RUN useradd -m -u 1000 dreamer
USER dreamer

EXPOSE 3010

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3010"]
