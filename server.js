import express from "express";
import morgan from "morgan";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();


// Connect to MongoDB
mongoose.connect(process.env.APP_DB_URL).then(conn => {
    console.log(conn.connection.host, ' khaled')
});


const app = express();


// Middleware
app.use(express.json());
app.use(morgan("dev"));



// Schema
const usersSchema = new mongoose.Schema({
    first_name: String,
    last_name: String,
});

// Model
const UsersModel = mongoose.model("users", usersSchema);


// Routes
app.post("/users", (req, res) => {
    console.log(req.body.first_name);
    const newUser = new UsersModel(req.body);
    newUser.save().then(() => {
        res.send("User created successfully");
    }).catch((err) => {
        res.send(err);
    });
});



// Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
