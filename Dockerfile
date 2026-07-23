FROM python:3.11-slim

# Create a non-root user and group
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies if required (e.g. for numerical computing)
# libgl1-mesa-glx and libglib2.0-0 are often required for opencv/scikit-image in some environments,
# but we try to keep it slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# We copy requirements first to leverage Docker cache
COPY backend/requirements.txt /app/backend/
COPY backend/requirements-ml.txt /app/backend/

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Install common dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Conditionally install ML dependencies
ARG INSTALL_ML=false
RUN if [ "$INSTALL_ML" = "true" ]; then \
        pip install --no-cache-dir -r requirements-ml.txt; \
    fi

# Copy all application code
COPY backend/ /app/backend/

# Ensure start.sh is executable and owned by appuser
RUN chmod +x /app/backend/scripts/start.sh && \
    chown -R appuser:appgroup /app/backend

# Switch to non-root user
USER appuser

# Expose port (Render sets this dynamically, defaults to 8000)
EXPOSE 8000

# Start server using the script
CMD ["/app/backend/scripts/start.sh"]
