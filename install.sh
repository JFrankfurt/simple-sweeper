#!/usr/bin/env bash

docker build . -t simple-sweeper

svc_path=/etc/systemd/user/simple-sweeper.service

cat > "$svc_path" <<-EOF
[Unit]
Description=Sweeper of funds from known private keys to a target eth address
Requires=docker.service
After=docker.service syslog.target network.target geth.service

[Service]
Restart=always
ExecStart=/usr/bin/docker start -a simple-sweeper
ExecStop=/usr/bin/docker stop -t 2 simple-sweeper

[Install]
WantedBy=local.target
EOF

systemctl daemon-reload > /dev/null
systemctl enable simple-sweeper.service > /dev/null
systemctl restart simple-sweeper.service