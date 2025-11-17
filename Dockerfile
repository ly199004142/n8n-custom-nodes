# 基于 n8n 官方镜像
FROM docker.n8n.io/n8nio/n8n:latest

# 切换到 root 用户以安装软件
USER root

# 安装 FFmpeg、FFprobe 和中文字体
RUN apk update && apk add --no-cache \
    ffmpeg \
    font-noto-cjk \
    fontconfig && \
    fc-cache -fv

# 验证安装
RUN ffmpeg -version && ffprobe -version && fc-list | grep -i "noto"

# 切换回 node 用户(如果需要的话,但我们在 docker-compose 中使用 root)
# USER node
