FROM bitnami/node:18 as builder
ENV NODE_ENV="production"
COPY . /app
WORKDIR /app
RUN yarn

FROM bitnami/node:18-prod
ENV NODE_ENV="production"
COPY --from=builder /app /app
WORKDIR /app
CMD ["yarn", "start"]
