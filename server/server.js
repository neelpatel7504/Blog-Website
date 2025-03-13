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
import aws from "aws-sdk";
import Notification from './Schema/Notification.js';
import Comment from "./Schema/Comment.js"
import { populate } from 'dotenv';


const server = express();
let PORT = 3000;

admin.initializeApp({
    credential: admin.credential.cert(serviceAccountKey)
  });

let emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/; // regex for email
let passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{6,20}$/; // regex for password

server.use(express.json());
server.use(express.urlencoded({ extended: true })); // Parses URL-encoded requests
server.use(cors({ origin: '*' })); //for accepting data from anywhere like from frontend port3175

mongoose.connect(process.env.DB_LOCATION, {
    autoIndex: true
})


//setting s3 bucket
const s3 = new aws.S3({
    region: 'eu-north-1',
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
})

const generateUploadURL = async () => {
    const date = new Date();
    const imageName = `${nanoid()}-${date.getTime()}.jpeg`;
    
    return await s3.getSignedUrlPromise('putObject', {
        Bucket: 'blog-banner-project',
        Key: imageName,
        Expires: 1000,
        ContentType: "image/jpeg"
    })
}





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
        req.user = user.id;
        next();
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


//upload image url
server.get('/get-upload-url', (req, res) => {
    generateUploadURL().then(url => res.status(200).json({ uploadURL: url }))
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })
})





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
    let { tag, author, query, page, limit, eliminate_blog } = req.body;

    let findQuery;
    if(tag){
        findQuery= { tags: tag, draft:false, blog_id: { $ne: eliminate_blog }};
    }else if(query){
        findQuery = { draft: false, title: new RegExp(query, 'i')}
    }else if(author){
        findQuery ={ author, draft: false }
    }


    let maxLimit= limit ? limit : 2;

    Blog.find(findQuery)
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
    .sort({ "publishedAt": -1 })
    .select("blog_id title des banner activity tags publishedAt -_id")
    .skip((page - 1) * maxLimit)
    .limit(maxLimit)
    .then(blogs => {
        return res.status(200).json({ blogs }); // ✅ This is correct
    })
    .catch(err => {
        return res.status(500).json({ error: err.message }); // ✅ Now .catch() is correctly chained
    });   
})



server.post("/search-blogs-count",(req,res)=>{
    let { tag, author, query } = req.body;

    let findQuery;
    if(tag){
        findQuery= { tags: tag, draft:false};
    }else if(query){
        findQuery = { draft: false, title: new RegExp(query, 'i')}
    }else if(author){
        findQuery ={ author, draft: false }
    }

    Blog.countDocuments(findQuery)
    .then(count => {
        return res.status(200).json({ totalDocs: count})
    })
    .catch(err=>{
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })
})

server.post("/search-users", (req,res)=>{
    let { query }= req.body;

    User.find({ "personal_info.username": new RegExp(query,'i')})
    .limit(50)
    .select("personal_info.fullname personal_info.username personal_info.profile_img -_id")
    .then(users => {
        return res.status(200).json({ users })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.post("/get-profile", (req,res)=>{
    let { username } =req.body;
    User.findOne({"personal_info.username": username })
    .select("-personal_info.password -google_auth -updatedAt -blogs")
    .then(user => {
        return res.status(200).json(user)
    })
    .catch(err => {
        console.log(err);
        return res.status(500).json({error: err.message})
    })
})


server.post('/create-blog', verifyJWT, (req,res) => {
    let authorId = req.user;
    let { title, des, banner, tags, content, draft, id } = req.body;
   // console.log(req.body); // Debugging step
    if(!title.length){
        return res.status(403).json({ error: "You must provide title to blog" });
    }
    if(!draft){
        if(!des.length || des.length > 200){
            return res.status(403).json({ error: "You must provide description under 200 to publish blog" });
        }
         if(!banner.length){
             return res.status(403).json({ error: "You must provide banner to publish blog" });
         }
        if(!content.blocks.length){
            return res.status(403).json({ error: "You must provide content to publish blog" });
        }
        if(!tags.length || tags.length > 10){
            return res.status(403).json({ error: "You must provide tags under 10 to publish blog" });
        }
    }
    tags = tags.map(tag => tag.toLowerCase());
    
    let blog_id = id || title.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, '-').trim() + nanoid();
    
    if(id){
         Blog.findOneAndUpdate({ blog_id }, { title, des, banner, content, tags, draft: draft ? draft : false })
         .then(() => {
            return res.status(200).json({ id:blog_id });
         })
          .catch(err => {
            return res.status(500).json({err: err.message });
          })


    }else{
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
    }

    
    
})


 server.post("/get-blog", (req,res)=>{
    let { blog_id, draft, mode } = req.body;
    let incrementVal = mode !== 'edit' ? 1 : 0;
    Blog.findOneAndUpdate({ blog_id }, { $inc : { "activity.total_reads": incrementVal }})
    .populate("author", "personal_info.fullname personal_info.username personal_info.profile_img")
    .select("title des content banner activity publishedAt blog_id tags")
    .then(blog => {
        User.findOneAndUpdate({ "personal_info.username": blog.author.personal_info.username }, {
            $inc : { "account_info.total_reads": incrementVal }
        })
        .catch(err=>{
            return res.status(500).json({error : err.message });
        })

        if(blog.draft && !draft){
           return res.status(500).json({ error:"You can not access draft logs!"})
        }

        return res.status(200).json({ blog });
    })
    .catch(err => {
        return res.status(500).json({ error : err.message });

    })
 })


 server.post("/like-blog", verifyJWT, (req, res)=>{
    let user_id = req.user;

    let { _id, islikedByUser } = req.body;

    let incrementVal = !islikedByUser ? 1 : -1;

    Blog.findOneAndUpdate({ _id }, { $inc : { "activity.total_likes": incrementVal }, $push : { "activity.liked_by_user": user_id }})
    .then(blog => {
       // User.findOneAndUpdate({ _id: blog.author }, { $inc : { "account_info.total_likes": incrementVal }})
       // .catch(err=>{
       //     return res.status(500).json({error : err.message });
       // })

        //return res.status(200).json({ liked_by_user: blog.activity.liked_by_user });
       
        if(!islikedByUser){
            let like = new Notification({
                type: "like",
                blog: _id,
                notification_for: blog.author,
                user: user_id
            })

            like.save().then(notification => {
                return res.status(200).json({ liked_by_user: true });
            })
        }
        else{
            Notification.findOneAndDelete({ user: user_id, type: "like", blog: _id })
            .then(data => {
                return res.status(200).json({ liked_by_user: false });
            })
            .catch(err => {
                return res.status(500).json({ error : err.message });
            })
        }
        })

})   

 server.post("/isliked-by-user", verifyJWT, (req, res)=>{
    let user_id = req.user;

    let { _id } = req.body;

    

    Notification.exists({ user: user_id, blog: _id, type: "like" })
    .then(result => {
        return res.status(200).json({ result });
    })
    .catch(err => {
        return res.status(500).json({ error : err.message });

    })

})


server.post("/add-comment", verifyJWT, (req, res)=>{
  let user_id = req.user;

  let { _id, comment, blog_author, replying_to } = req.body;

  if(!comment.length){
    return res.status(403).json({error: "write something to leave a comment "});
  }

  // creating a comment document
  let commentObj= {
   blog_id: _id,
   blog_author,
   comment,
   commented_by: user_id,

  }

  if(replying_to){
    commentObj.parent = replying_to;
    commentObj.isReply = true;
  }
  

  new Comment(commentObj).save().then(async (commentFile) => {
    let {comment, commentedAt, children }= commentFile;

    Blog.findOneAndUpdate({ _id }, { $push: { "comments": commentFile._id }, $inc : {"activity.total_comments":1, "activity.total_parent_comments": replying_to ? 0 : 1 } })
    .then(blog => {console.log("New Comment created!")});

    let notificationObj = {
        type: replying_to ? "reply" : "comment",
        blog: _id,
        notification_for: blog_author,
        user: user_id,
        comment: commentFile._id
    }

    if(replying_to){
       notificationObj.replied_on_comment = replying_to;

       await Comment.findOneAndUpdate({ _id: replying_to }, { $push: { children: commentFile._id }})
       .then(replyingToCommentDoc => { notificationObj.notification_for = replyingToCommentDoc.commented_by })
       
       
    }

    new Notification(notificationObj).save().then(notification => console.log("New notification created!"));

    return res.status(200).json({
        comment, commentedAt, _id: commentFile._id, user_id, children
    })
     })

})


server.post("/get-blog-comments", (req, res) => {

    let { blog_id, skip } = req.body;

    let maxLimit = 5;
    Comment.find({ blog_id, isReply: false })
    .populate("commented_by", "personal_info.username personal_info.fullname personal_info.profile_img" )
    .skip(skip)
    .limit(maxLimit)
    .sort({
        'commentedAt': -1
    })
    .then(comment => {
        return  res.status(200).json(comment);
    })
    .catch(err => {
        console.log(err.message);
        return req.status(500).json({ error: err.message })
    })
})

server.post("/get-replies", (req, res)=>{
    let { _id, skip } =req.body;

    let maxLimit = 5;
    Comment.findOne({ _id })
    .populate({
        path: "children",
        option: {
            limit: maxLimit,
            skip: skip,
            sort: { 'commentedAt': -1 },
        },
        populate:{
           path: 'commented_by',
           select: "personal_info.profile_img personal_info.fullname personal_info.username"
        },
        select: "-blog_id -updatedAt"
    })
    .select("children")
    .then( doc => {
        return res.status(200).json({ replies: doc.children})
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

const deleteComments = (_id )=>{
    Comment.findOneAndDelete({ _id })
    .then(comment => {
        if(comment.parent){
            Comment.findOneAndUpdate({ _id: comment.parent }, {$pull: { children: _id }})
            .then(data => console.log('Comment deleted from parent'))
            .catch(err => console.log(err));
        }

        Notification.findOneAndDelete({ comment: _id }).then(notification => console.log('comment notification deleted!'))

        Notification.findOneAndDelete({ reply: _id }).then(notification => console.log('reply nnotification deleted!'))

        Blog.findOneAndUpdate({ _id: comment.blog_id }, { $pull: { comments: _id },$inc: { "activity.total_comments": -1 }, "activity.total_parent_comments": comment.parent ? 0 : -1 })
        .then(blog => {
            if(comment.children.length){
                comment.children.map(replies =>{
                    deleteComments(replies)
                })
            }
        })
    })
    .catch(err => {
        console.log(err.message);
    })
}

server.post("/delete-comment", verifyJWT, (req, res) =>{
     let user_id =req.user;
     let { _id }= req.body;
     
     Comment.findOne({ _id })
     .then(comment => {
        if(user_id == comment.commented_by || user_id == comment.blog_author ){

            deleteComments(_id)

            return res.status(200).json({status: 'done!' });

        }else{
            return res.status(403).json({error: "You can not delete this comment!"})
        }
     })
})


server.listen(PORT, () => {
    console.log('listening on port -> ' + PORT);
    
})