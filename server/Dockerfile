# Ephemeris API — kernels are mounted at runtime (see KERNELS_ROOT).
FROM python:3.13-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY server/ /app/
# Tiny leap-seconds kernel — always present so the API can boot before the
# volume is populated. Runtime SPKs still come from KERNELS_ROOT (/kernels).
COPY public/kernels/lsk/naif0012.tls /app/bundled-kernels/lsk/naif0012.tls

ENV KERNELS_ROOT=/kernels
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Single worker: CSPICE / spiceypy is not freely multi-threaded.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
