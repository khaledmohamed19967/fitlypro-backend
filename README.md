# Fitly Pro Backend

A feature-based Node.js backend API built with Express and MongoDB, following best practices and clean architecture principles.

## 📁 Project Structure

```
fitly-pro-backend/
├── src/
│   ├── config/              # Configuration files
│   │   ├── database.js      # Database connection
│   │   └── index.js         # App configuration
│   ├── middlewares/         # Global middlewares
│   │   ├── errorHandler.js  # Error handling middleware
│   │   └── validate.js      # Validation middleware
│   ├── modules/             # Feature modules
│   │   └── users/           # User module
│   │       ├── user.model.js
│   │       ├── user.controller.js
│   │       ├── user.service.js
│   │       ├── user.routes.js
│   │       ├── user.validator.js
│   │       └── index.js
│   ├── routes/              # Routes configuration
│   │   └── index.js         # Main routes
│   ├── utils/               # Utility functions
│   │   ├── ApiError.js      # Custom error class
│   │   ├── ApiResponse.js   # Response formatter
│   │   └── asyncHandler.js  # Async handler wrapper
│   ├── app.js               # Express app setup
│   └── server.js            # Server entry point
├── .env                     # Environment variables
├── .env.example             # Environment variables template
├── .gitignore               # Git ignore file
├── package.json             # Dependencies
└── README.md                # Documentation
```

## 🚀 Features

- ✅ Feature-based modular architecture
- ✅ Clean separation of concerns (MVC pattern)
- ✅ Centralized error handling
- ✅ Request validation with Joi
- ✅ MongoDB with Mongoose ODM
- ✅ Environment-based configuration
- ✅ Security best practices (Helmet, CORS)
- ✅ Logging with Morgan
- ✅ Graceful shutdown handling

## 🛠️ Installation

1. Install dependencies:
```bash
npm install
# or
pnpm install
```

2. Copy `.env.example` to `.env` and update values:
```bash
cp .env.example .env
```

3. Update your MongoDB connection string in `.env`

## 📦 Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## 📚 API Endpoints

### Health Check
- `GET /` - Root endpoint
- `GET /api/v1/health` - Health check

### Users
- `GET /api/v1/users` - Get all users (with pagination & search)
- `GET /api/v1/users/:id` - Get user by ID
- `POST /api/v1/users` - Create new user
- `PUT /api/v1/users/:id` - Update user
- `DELETE /api/v1/users/:id` - Delete user (soft delete)
- `GET /api/v1/users/stats` - Get user statistics

### Example Request

Create a user:
```bash
POST http://localhost:8000/api/v1/users
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "phone": "1234567890",
  "gender": "male",
  "role": "user"
}
```

Get users with pagination:
```bash
GET http://localhost:8000/api/v1/users?page=1&limit=10&search=john&role=user
```

## 🏗️ Architecture

### Module Structure
Each feature module follows this structure:
- **model.js** - Database schema and model
- **controller.js** - Request handlers
- **service.js** - Business logic
- **routes.js** - Route definitions
- **validator.js** - Validation schemas
- **index.js** - Module exports

### Flow
```
Request → Routes → Validation → Controller → Service → Model → Database
                                                ↓
Response ← Error Handler ← ApiResponse/ApiError
```

## 🔒 Environment Variables

See `.env.example` for all available variables.

## 🤝 Contributing

1. Create feature branches from `main`
2. Follow the existing code structure
3. Write meaningful commit messages
4. Test your changes

## 📝 Adding New Modules

To add a new feature module (e.g., workouts):

1. Create folder: `src/modules/workouts/`
2. Add files: `workout.model.js`, `workout.controller.js`, `workout.service.js`, `workout.routes.js`, `workout.validator.js`
3. Export in `src/modules/workouts/index.js`
4. Register routes in `src/routes/index.js`

Example:
```javascript
// src/routes/index.js
import workoutRoutes from '../modules/workouts/workout.routes.js';
router.use('/workouts', workoutRoutes);
```

## 📄 License

ISC
