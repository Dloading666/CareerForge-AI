FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# CJK 字体：用于 export_resume_pdf 生成的简历 PDF 嵌入中文字形，
# 避免在缺少 Adobe CJK 字体的查看器里中文渲染成空白。
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 可选 pip 主索引镜像：默认官方 PyPI，国内构建可传
# --build-arg PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple 加速普通包下载。
# torch 走 requirements.txt 里的 --extra-index-url（PyTorch CPU 源），不受此影响。
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
