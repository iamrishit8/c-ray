# Shop API

A small REST API for users and orders.

## Architecture

We chose Express because the team already knew it and it keeps the HTTP layer thin.
Requests go through routes -> controllers -> services -> Mongoose models.
Payments are delegated to an external payment provider over HTTP.
