# Auth Package 

This package provides a reusable authentication utility module for Node.js + TypeScript applications. It is designed to handle secure user authentication features such as password hashing, JWT token generation, and token verification.


## Features

- JWT Access Token (15 min expiry)
- JWT Refresh Token (7 days expiry)
- JWT verification
- Password hashing with bcrypt
- Password comparison utility
- Type-safe with TypeScript


## Installation

npm install bcrypt jsonwebtoken


## Environment Variables

JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret


## Structure

packages/auth/
 ├── jwt.ts
 ├── password.ts
 ├── otp.ts
 ├── middleware.ts
 ├── types.ts
 ├── index.ts


## Tech Stack

- Node.js
- TypeScript
- bcrypt
- jsonwebtoken