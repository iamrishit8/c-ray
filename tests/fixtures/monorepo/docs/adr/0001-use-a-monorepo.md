# 1. Use a monorepo with shared types

Date: 2023-03-14

## Status

Accepted

## Context

The API and the web client kept drifting apart on the shape of invoices.

## Decision

We will keep the API, the web client and a shared package in one repository so
both sides import the same types and money helpers.

## Consequences

Builds are slower, but contract changes show up as compile errors.
