import express, { json } from 'express';
import mongoose from 'mongoose';
import 'dotenv/config'
import bcrypt from 'bcrypt';
import User from './Schema/User.js'; //user schema
import Blog from './Schema/Blog.js'; //blog schema
import { nanoid } from 'nanoid';
import jwt from 'jsonwebtoken';
const { verify } = jwt;
import cors from 'cors';
import admin from "firebase-admin";
import serviceAccountKey from "./blog-website-react-9778f-firebase-adminsdk-fbsvc-b7637b2b32.json" assert { type: "json" }
import { getAuth } from "firebase-admin/auth"

const server = express();
let PORT = 3000;

admin.initializeApp({
    credential: admin.credential.cert(serviceAccountKey)
  });

let emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/; // regex for email
let passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{6,20}$/; // regex for password

server.use(express.json());
server.use(cors()); //for accepting data from anywhere like from frontend port3175

mongoose.connect(process.env.DB_LOCATION, {
    autoIndex: true
})

const verifyJWT = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(" ")[1];

    if(token == null){
        return res.status(401).json({ error: "No access token" })
    }

    jwt.verify(token, process.env.SECRET_ACCESS_KEY, (err, user) => {
        if(err){
            return res.status(403).json({ error: "Access token is invalid" })
        }
        req.user = user.id
        next()
    })
}

const formateDatatoSend = (user) => {

    const access_token = jwt.sign({ id: user._id }, process.env.SECRET_ACCESS_KEY)
    return {
        access_token,
        profile_img: user.personal_info.profile_img,
        username: user.personal_info.username,
        fullname: user.personal_info.fullname
    }
}

const generateUsername = async (email) => {
    let username = email.split("@")[0];

    let isUsernameNotUnique = await User.exists({ "personal_info.username": username }).then((result) => result)

    isUsernameNotUnique ? username += nanoid().substring(0,5) : "";

    return username;
}

server.post("/signup", (req,res) => {
    let { fullname, email, password } = req.body;
    if(fullname.length < 3){
        return res.status(403).json({ "error": "Fullname must be at least 3 letters long" })
    }
    if(!email.length){
        return res.status(403).json({ "error": "Enter Email" })
    }
    if(!emailRegex.test(email)){
        return res.status(403).json({ "error": "Email is invalid" })
    }
    if(!passwordRegex.test(password)){
        return res.status(403).json({ "error": "Password should be 6 to 20 characters long with a numeric, 1 lowercase, 1 uppercase letters" })
    }

    bcrypt.hash(password, 10, async (err, hased_password) => {

        let username = await generateUsername(email);

        let user = new User({
            personal_info: { fullname, email, password: hased_password, username }
        })

        user.save().then((u) => {
            return res.status(200).json(formateDatatoSend(u))
        })
        .catch( err=> {
            if(err.code == 11000){
                return res.status(500).json({ "error": "Email already exist" })
            }

             return res.status(500).json({ "error": err.message })
        })

        
    })

})

server.post("/signin", (req, res) => {

    let { email, password } = req.body;

    User.findOne({ "personal_info.email": email })
    .then((user) => {
        if(!user){
            return res.status(403).json({ "error": "Email not found" })
        }

        if(!user.google_auth){
            bcrypt.compare(password, user.personal_info.password, (err, result) => {
                if(err){
                    return res.status(403).json({ "error": "error occured while login, Please try again!" })
                }
                if(!result){
                    return res.status(403).json({ "error": "incorrect password" })
                }else{
                    return res.status(200).json(formateDatatoSend(user))
                }
            })
        }
        else{
            return res.status(500).json({ "error": "Account was created using Google. Try Continue with Google" })
        }
        
    })
    .catch(err => {
        console.log(err);
        return res.status(500).json({ "error": err.message })
        
    })

})

server.post("/google-auth", async (req, res) => {
    const { access_token } = req.body;

    if (!access_token) {
        return res.status(400).json({ error: "Access token is required." });
    }

    getAuth()
        .verifyIdToken(access_token)
        .then(async (decodedUser) => {
            const { email, name, picture } = decodedUser;
            let user = await User.findOne({ "personal_info.email": email });

            if (user) {
                if (!user.google_auth) {
                    return res.status(403).json({
                        error: "This email was signed up without Google. Please log in with a password.",
                    });
                }
            } else {
                const username = await generateUsername(email);
                user = new User({
                    personal_info: {
                        fullname: name,
                        email,
                        profile_img: picture, // .replace("s96-c", "s384-c"),
                        username,
                    },
                    google_auth: true,
                });
                await user.save();
            }
            return res.status(200).json(formateDatatoSend(user));
        })
        .catch((err) => {
            console.error(err);
            return res.status(500).json({ error: "Google authentication failed." });
        });
});



server.post('/latest-blogs', (req, res) => {
 
    let { page } = req.body;

    let maxLimit = 5;

    Blog.find({ draft: false })
        .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
        .sort({ "publishedAt": -1 })
        .select("blog_id title des banner activity tags publishedAt -_id")
        .skip((page - 1)* maxLimit)
        .limit(maxLimit)
        .then(blogs => {
            return res.status(200).json({ blogs }); // ✅ This is correct
        })
        .catch(err => {
            return res.status(500).json({ error: err.message }); // ✅ Now .catch() is correctly chained
        });
});


server.post('/all-latest-blogs-count',(req,res)=>{

    Blog.countDocuments({draft:false})
    .then(count =>{
        return res.status(200).json({ totalDocs: count})

    })
    .catch(err=>{
        console.log(err.message);
        return res.status(500).json({error:err.message })
    })
})

server.get('/trending-blogs', (req, res) => {
   // let maxLimit = 5;

    Blog.find({ draft: false })
        .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
        .sort({ "activity.total_read":-1, "activity.total_likes":-1, "publishedAt":-1})
        .select("blog_id title publishedAt -_id")
        .limit(5)
        .then(blogs => {
            return res.status(200).json({ blogs }); // ✅ This is correct
        })
        .catch(err => {
            return res.status(500).json({ error: err.message }); // ✅ Now .catch() is correctly chained
        });
});

server.post("/search-blogs",(req,res)=>{
    let { tag } = req.body;

    let findQuery = { tags: tag, draft:false};

    let maxLimit=5;

    Blog.find(findQuery)
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
    .sort({ "publishedAt": -1 })
    .select("blog_id title des banner activity tags publishedAt -_id")
    .limit(maxLimit)
    .then(blogs => {
        return res.status(200).json({ blogs }); // ✅ This is correct
    })
    .catch(err => {
        return res.status(500).json({ error: err.message }); // ✅ Now .catch() is correctly chained
    });   
})


server.post('/create-blog', verifyJWT, (req,res) => {
    let authorId = req.user;
    let { title, des, banner, tags, content, draft } = req.body;
    
    if(!title.length){
        return res.status(403).json({ error: "You must provide title to blog" });
    }
    if(!draft){
        if(!des.length || des.length > 200){
            return res.status(403).json({ error: "You must provide description under 200 to publish blog" });
        }
        // if(!banner.length){
        //     return res.status(403).json({ error: "You must provide banner to publish blog" });
        // }
        if(!content.blocks.length){
            return res.status(403).json({ error: "You must provide content to publish blog" });
        }
        if(!tags.length || tags.length > 10){
            return res.status(403).json({ error: "You must provide tags under 10 to publish blog" });
        }
    }
    tags = tags.map(tag => tag.toLowerCase());
    
    let blog_id = title.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, '-').trim() + nanoid();
    
    let blog = new Blog({
        title, des, banner, content, tags, author: authorId, blog_id, draft: Boolean(draft)
    })

    blog.save().then(blog => {
        let incrementVal = draft ? 0 : 1;
        User.findOneAndUpdate({ _id: authorId }, { $inc : { "account_info.total_posts" : incrementVal }, $push : { "blogs": blog._id } })
        .then(user => {
            return res.status(200).json({ id: blog.blog_id })
        })
        .catch(err => {
            return res.status(500).json({ error: "Failed to update total posts number" })
        })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
    
})

server.listen(PORT, () => {
    console.log('listening on port -> ' + PORT);
    
})