FROM python:3.12-slim
RUN pip install --no-cache-dir "fastmcp>=2.0,<3" httpx
COPY server.py /app/server.py
WORKDIR /app
EXPOSE 8812
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8812
CMD ["python", "server.py"]
