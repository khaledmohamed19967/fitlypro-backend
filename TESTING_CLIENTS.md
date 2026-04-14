# Testing the Clients Module

## Quick Start Guide

This guide will help you test the clients module using either Postman or curl.

## Prerequisites

1. **Server is running** on `http://localhost:8000`
2. **You have a trainer account** (role: 'trainer')
3. **You have an authentication token**

## Step 1: Get Authentication Token

First, you need to login as a trainer to get an authentication token.

### Using curl:
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "trainer@example.com",
    "password": "password123"
  }'
```

### Using Postman:
1. Import `postman/Clients_API.postman_collection.json`
2. Run "Login as Trainer" request
3. Token will be automatically saved to collection variables

### Response:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": { ... }
  }
}
```

**Copy the token** - you'll need it for all subsequent requests.

---

## Step 2: Create Your First Client

### Using curl:
```bash
curl -X POST http://localhost:8000/api/v1/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "password": "client123",
    "phone": "1234567890",
    "dateOfBirth": "1990-01-01",
    "gender": "male",
    "primaryFitnessGoal": "weight_loss",
    "currentWeight": 85,
    "targetWeight": 75,
    "height": 180,
    "experienceLevel": "intermediate",
    "programType": "personal_training",
    "sessionsPerWeek": 3,
    "startDate": "2026-01-01",
    "packageDuration": "3_months",
    "additionalNotes": "Prefers morning sessions"
  }'
```

### Using Postman:
1. Use "Create Client" request
2. Token is already set if you logged in
3. Click Send

### Response:
```json
{
  "success": true,
  "message": "Client created successfully",
  "data": {
    "id": "679a1b2c3d4e5f6a7b8c9d0e",
    "user": {
      "firstName": "John",
      "lastName": "Doe",
      "fullName": "John Doe",
      "email": "john.doe@example.com",
      ...
    },
    "trainer": { ... },
    "primaryFitnessGoal": "weight_loss",
    "currentWeight": 85,
    "bmi": "26.23",
    ...
  }
}
```

**Save the client ID** from the response!

---

## Step 3: Get All Your Clients

### Using curl:
```bash
curl -X GET "http://localhost:8000/api/v1/clients?page=1&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Using Postman:
Use "Get All My Clients" request

### Response:
```json
{
  "success": true,
  "message": "Clients retrieved successfully",
  "data": {
    "clients": [ ... ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 5,
      "pages": 1
    }
  }
}
```

---

## Step 4: Get Client Details

Replace `CLIENT_ID` with the actual client ID from Step 2.

### Using curl:
```bash
curl -X GET http://localhost:8000/api/v1/clients/CLIENT_ID \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Using Postman:
Use "Get Client by ID" request (update the :id variable)

---

## Step 5: Update Client Information

### Using curl:
```bash
curl -X PUT http://localhost:8000/api/v1/clients/CLIENT_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "currentWeight": 80,
    "targetWeight": 72,
    "experienceLevel": "advanced",
    "additionalNotes": "Making excellent progress!"
  }'
```

### Using Postman:
Use "Update Client" request

---

## Step 6: Add Progress Note

Track your client's progress over time.

### Using curl:
```bash
curl -X POST http://localhost:8000/api/v1/clients/CLIENT_ID/progress \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "weight": 78,
    "notes": "Lost 2kg this week! Great motivation and consistency."
  }'
```

### Using Postman:
Use "Add Progress Note" request

---

## Step 7: Get Statistics

See overview of all your clients.

### Using curl:
```bash
curl -X GET http://localhost:8000/api/v1/clients/stats \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Using Postman:
Use "Get Trainer Statistics" request

### Response:
```json
{
  "success": true,
  "message": "Statistics retrieved successfully",
  "data": {
    "totalClients": 25,
    "activeClients": 20,
    "inactiveClients": 3,
    "completedClients": 2
  }
}
```

---

## Advanced: Search Clients

Search by firstName, lastName, or email.

### Using curl:
```bash
curl -X GET "http://localhost:8000/api/v1/clients?search=john" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## Advanced: Filter by Status

Get only active clients:

### Using curl:
```bash
curl -X GET "http://localhost:8000/api/v1/clients?status=active" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Status options:**
- `active`
- `inactive`
- `completed`
- `on_hold`

---

## Common Issues & Solutions

### ❌ Error: "Not authorized to access this route"
**Solution:** Check your token is valid and included in the header:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

### ❌ Error: "Only trainers can add clients"
**Solution:** Make sure you're logged in as a user with role: 'trainer', not 'client'.

### ❌ Error: "User with this email already exists"
**Solution:** Use a different email address for the new client.

### ❌ Error: "You do not have access to this client"
**Solution:** This client belongs to another trainer. You can only access your own clients.

### ❌ Error: "Validation failed"
**Solution:** Check the error message for specific field requirements:
- firstName, lastName: 2-50 characters
- email: valid email format
- password: minimum 6 characters
- currentWeight/targetWeight: 20-300 kg
- height: 50-250 cm
- sessionsPerWeek: 1-7

---

## Testing Workflow Example

Here's a complete workflow to test all features:

```bash
# 1. Login as trainer
TOKEN=$(curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"trainer@example.com","password":"password123"}' \
  | jq -r '.data.token')

# 2. Create a client
CLIENT_ID=$(curl -X POST http://localhost:8000/api/v1/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "firstName":"Sarah",
    "lastName":"Smith",
    "email":"sarah.smith@example.com",
    "password":"client123",
    "primaryFitnessGoal":"muscle_gain",
    "currentWeight":60,
    "targetWeight":65,
    "height":165
  }' | jq -r '.data.id')

# 3. Get all clients
curl -X GET "http://localhost:8000/api/v1/clients" \
  -H "Authorization: Bearer $TOKEN"

# 4. Add progress note
curl -X POST "http://localhost:8000/api/v1/clients/$CLIENT_ID/progress" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"weight":61,"notes":"First week - gained 1kg"}'

# 5. Get statistics
curl -X GET "http://localhost:8000/api/v1/clients/stats" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Database Verification

You can verify the data in MongoDB:

```javascript
// Connect to MongoDB
use fitly_pro

// Check if User was created
db.users.findOne({ email: "john.doe@example.com" })

// Check if Client was created
db.clients.findOne().populate('user')

// See all clients for a trainer
db.clients.find({ trainer: ObjectId("TRAINER_ID") })
```

---

## Next Steps

After testing the API:

1. ✅ Verify all CRUD operations work
2. ✅ Test pagination and filtering
3. ✅ Test search functionality
4. ✅ Test progress tracking
5. ✅ Verify access control (try accessing another trainer's client)
6. ✅ Test validation errors
7. ✅ Test soft delete functionality

---

## Need Help?

- Check `src/modules/clients/README.md` for detailed documentation
- Review validation rules in `client.validator.js`
- Check error messages - they're descriptive and will guide you
- Verify your user has role: 'trainer' in the database
