FROM bitnami/node:16 as builder
ENV NODE_ENV="production"
COPY . /app
WORKDIR /app
RUN npm ci --only=production

FROM bitnami/node:16-prod
ENV NODE_ENV="production"
COPY --from=builder /app /app
WORKDIR /app
CMD ["npm", "start"]
