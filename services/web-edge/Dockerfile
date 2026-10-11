# The publisher copies the already verified output into this isolated context.
# No install, regeneration or application secrets enter the image build.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY .output ./.output
COPY web-origin/origin.mjs web-origin/start-origin.mjs ./web-origin/
EXPOSE 3000
CMD ["node", "web-origin/start-origin.mjs"]
