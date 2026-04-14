# Clients Module

## Overview

The Clients module enables trainers to manage their clients within the Fitly Pro platform. It uses a **single-model architecture** where all user data (personal info + fitness data) is stored in the User model.

## Architecture

### Single-Model Approach

The module uses **one User model** for everything:

**User Model** (`src/modules/users/user.model.js`)
- **Personal Information**: `firstName`, `lastName`, `email`, `password`, `phone`, `dateOfBirth`, `gender`
- **Authentication**: `role` field ('client', 'trainer', or 'admin')
- **Trainer Relationship**: `trainer` field (references the coach)
- **Fitness Data (Optional)**: `primaryFitnessGoal`, `currentWeight`, `targetWeight`, `height`, `experienceLevel`
- **Program Details (Optional)**: `programType`, `sessionsPerWeek`, `startDate`, `packageDuration`, `endDate`
- **Additional Info (Optional)**: `additionalNotes`, `medicalConditions`, `injuries`
- **Progress Tracking**: `progressNotes[]` array

### Why Single Model?

✅ **Simplicity**: One model to manage, no complex joins or transactions  
✅ **Flexibility**: Users can register without fitness data, add it later  
✅ **Clean Schema**: Fitness fields are optional, won't clutter regular user registrations  
✅ **Easy Queries**: All data in one place, faster and simpler queries  

## Use Cases

### 1. Coach Creates Client
When a coach adds a client, **all fields can be filled**:
- Personal info (firstName, lastName, email, password)
- Fitness data (goals, weight, height)
- Program details (sessions, duration)
- Creates user with `role: 'client'` and `trainer: coachId`

### 2. User Registers Themselves
When someone registers normally:
- Only personal info required (firstName, lastName, email, password)
- Fitness fields left empty (optional)
- Can update their profile later to add fitness data

### 3. User Updates Profile
Any user (client or not) can update their fitness information:
- Add goals, weight, height whenever they want
- Track progress over time
- No need for separate "client" record

## API Endpoints

All endpoints require authentication and 'trainer' or 'admin' role.

### 1. Create Client
```http
POST /api/v1/clients
Authorization: Bearer <token>
Content-Type: application/json

{
  // Personal Information (required)
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "password": "securePass123",
  "phone": "1234567890",
  "dateOfBirth": "1990-01-01",
  "gender": "male",
  
  // Fitness Information (optional)
  "primaryFitnessGoal": "weight_loss",
  "currentWeight": 85,
  "targetWeight": 75,
  "height": 180,
  "experienceLevel": "intermediate",
  
  // Program Details (optional)
  "programType": "personal_training",
  "sessionsPerWeek": 3,
  "startDate": "2026-01-01",
  "packageDuration": "3_months",
  
  // Additional Information (optional)
  "additionalNotes": "Client prefers morning sessions",
  "medicalConditions": "None",
  "injuries": "Previous knee injury"
}
```

**What Happens:**
- Creates a new User with `role: 'client'`
- Sets `trainer` field to coach's ID
- Stores all fitness data in the User record
- All in one operation, no transactions needed!

### 2. Get All My Clients
```http
GET /api/v1/clients?page=1&limit=10&search=john
Authorization: Bearer <token>
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `search` (optional): Search by firstName, lastName, or email

### 3. Get Client by ID
```http
GET /api/v1/clients/:id
Authorization: Bearer <token>
```

### 4. Update Client
```http
PUT /api/v1/clients/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "currentWeight": 80,
  "targetWeight": 72,
  "experienceLevel": "advanced",
  "additionalNotes": "Making great progress!"
}
```

**Note:** Can update any field (personal info or fitness data) in one request!

### 5. Delete Client (Soft Delete)
```http
DELETE /api/v1/clients/:id
Authorization: Bearer <token>
```

Sets `isActive: false` on the user account.

### 6. Add Progress Note
```http
POST /api/v1/clients/:id/progress
Authorization: Bearer <token>
Content-Type: application/json

{
  "weight": 78,
  "notes": "Great progress this week! Lost 2kg."
}
```

### 7. Get Trainer Statistics
```http
GET /api/v1/clients/stats
Authorization: Bearer <token>
```

## Field Reference

### Fitness Goals (primaryFitnessGoal)
- `weight_loss`
- `muscle_gain`
- `general_fitness`
- `endurance`
- `strength`
- `flexibility`
- `sports_performance`
- `rehabilitation`

### Experience Levels
- `beginner`
- `intermediate`
- `advanced`
- `expert`

### Program Types
- `personal_training`
- `group_training`
- `online_coaching`
- `nutrition_only`
- `hybrid`

### Package Durations
- `1_month`
- `3_months`
- `6_months`
- `12_months`
- `ongoing`

## Validation Rules

### Required Fields (when creating client)
- `firstName`: 2-50 characters
- `lastName`: 2-50 characters
- `email`: Valid email format, unique
- `password`: Minimum 6 characters

### Optional Fields
- `phone`: 10-15 digits
- `dateOfBirth`: Cannot be in the future
- `gender`: male, female, or other
- `primaryFitnessGoal`: From enum list
- `currentWeight`: 20-300 kg
- `targetWeight`: 20-300 kg
- `height`: 50-250 cm
- `experienceLevel`: From enum list
- `sessionsPerWeek`: 1-7
- `additionalNotes`: Max 1000 characters
- `medicalConditions`: Max 500 characters
- `injuries`: Max 500 characters

## Virtual Fields

The User model includes computed fields:

### BMI (Body Mass Index)
```javascript
bmi = weight (kg) / (height (m))²
```

### Weight Difference
```javascript
weightDifference = currentWeight - targetWeight
```

These are calculated on-the-fly and not stored in the database.

## Security & Access Control

### Authentication
- Valid JWT token required in Authorization header
- User role must be 'trainer' or 'admin'

### Authorization
- Trainers can only access their own clients
- Service verifies `client.trainer === req.user.id`
- Prevents unauthorized access

### Password Security
- Hashed using bcrypt before storage
- Never returned in API responses
- `select: false` in schema

## Progress Tracking

Track client improvements over time:

```javascript
progressNotes: [
  {
    date: "2026-01-15T10:30:00Z",
    weight: 80,
    notes: "Lost 2kg this week!",
    recordedBy: trainerId
  },
  ...
]
```

## Database Indexes

For optimal query performance:

```javascript
User Model Indexes:
- email: 1 (unique)
- createdAt: -1
- trainer: 1 (for finding clients by trainer)
```

## Example: Complete Flow

### 1. Coach Creates Client
```bash
POST /api/v1/clients
{
  "firstName": "Sarah",
  "lastName": "Johnson",
  "email": "sarah@example.com",
  "password": "client123",
  "primaryFitnessGoal": "weight_loss",
  "currentWeight": 70,
  "targetWeight": 60,
  "height": 165
}
```

**Database:**
```javascript
User {
  _id: "679...",
  firstName: "Sarah",
  lastName: "Johnson",
  email: "sarah@example.com",
  password: "$2a$10...", // hashed
  role: "client",
  trainer: ObjectId("coach_id"),
  primaryFitnessGoal: "weight_loss",
  currentWeight: 70,
  targetWeight: 60,
  height: 165,
  progressNotes: []
}
```

### 2. Coach Views All Clients
```bash
GET /api/v1/clients
```

**Query:**
```javascript
User.find({
  role: 'client',
  trainer: coachId
})
```

### 3. Coach Adds Progress Note
```bash
POST /api/v1/clients/679.../progress
{
  "weight": 68,
  "notes": "Down 2kg this month!"
}
```

**Updated:**
```javascript
progressNotes: [
  {
    date: "2026-01-15",
    weight: 68,
    notes: "Down 2kg this month!",
    recordedBy: coachId
  }
]
```

## Files Structure

```
src/modules/clients/
├── client.service.js     # Business logic (uses User model)
├── client.controller.js  # HTTP handlers
├── client.routes.js      # Route definitions
├── client.validator.js   # Validation schemas
├── index.js              # Module exports
└── README.md             # This file

src/modules/users/
└── user.model.js         # User schema with optional fitness fields
```

## Migration from Old Approach

If you had a separate Client model before:

**Old (Two Models):**
```javascript
User: { firstName, lastName, email, role, trainer }
Client: { user, trainer, fitnessData... }
```

**New (Single Model):**
```javascript
User: { 
  firstName, lastName, email, role, trainer,
  // Optional fitness fields:
  primaryFitnessGoal, currentWeight, height, ...
}
```

**Benefits:**
- ✅ No transactions needed
- ✅ Simpler queries
- ✅ Faster operations
- ✅ Less code to maintain
- ✅ Users can be clients without coach assignment

## Testing the API

See `TESTING_CLIENTS.md` for detailed testing instructions.

**Quick Test:**
```bash
# 1. Login as trainer
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"trainer@example.com","password":"password123"}'

# 2. Create client (with token from step 1)
curl -X POST http://localhost:8000/api/v1/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "firstName":"John",
    "lastName":"Doe",
    "email":"john@example.com",
    "password":"client123",
    "primaryFitnessGoal":"weight_loss"
  }'
```

## Future Enhancements

- [ ] Client self-service profile updates
- [ ] Workout plan assignments
- [ ] Meal plan integration
- [ ] Body measurements tracking
- [ ] Progress photos
- [ ] Goal achievement notifications
- [ ] Client dashboard with charts

## Related Modules

- **Users Module**: Base User model with fitness fields
- **Auth Module**: Login, registration, JWT tokens
