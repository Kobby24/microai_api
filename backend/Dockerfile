# MicroAI backend: FastAPI + R/Bioconductor (affy MAS5) for Affymetrix CEL preprocessing.
# Build context: backend/   (docker build -t microai-backend backend)
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    MICROAI_REQUIRE_R=1

# --- R runtime + Bioconductor affy -------------------------------------------
# Debian's binary packages give a reproducible R 4.2 / Bioconductor 3.16 stack
# without compiling affy (C code) from source. hgu133acdf is a pure-data package
# and installs from Bioconductor without a compiler.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        r-base-core \
        r-bioc-affy \
        r-bioc-biobase \
        r-bioc-biocgenerics \
        r-bioc-preprocesscore \
        r-bioc-annotationdbi \
        r-cran-biocmanager \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# hgu133acdf = CDF environment for GPL96 / HG-U133A (required by ReadAffy + mas5).
# Any install failure or missing package aborts the build (quit(status = 1)).
COPY install_r_packages.R /tmp/install_r_packages.R
RUN Rscript --vanilla /tmp/install_r_packages.R && rm /tmp/install_r_packages.R

# --- Python dependencies -------------------------------------------------------
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- Application -----------------------------------------------------------------
COPY . .

# Final build-time sanity check of the R toolchain the API will use.
RUN Rscript --version && test -f /app/affy_mas5.R

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

ENV PORT=10000
EXPOSE 10000
# Render injects $PORT; models are loaded from ./models relative to /app.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
