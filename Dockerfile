FROM node:18
# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY . .

RUN yarn
CMD ["yarn", "start"]