const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

//Verify Token API
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "cvzkbbfnvkdf", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

// Validate Password
const validatePassword = (password) => {
  return password.length > 6;
};

// User Registration
app.post("/register/", async (request, response) => {
  const { name, username, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    const createUserQuery = `INSERT INTO user(name, username, password, gender)
        VALUES('${name}', '${username}', '${hashedPassword}', '${gender}');`;
    if (validatePassword(password)) {
      const dbResponse = await db.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//User Login API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "cvzkbbfnvkdf");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserDetails = `SELECT * FROM user WHERE username='${username}';`;
  const userProfile = await db.get(getUserDetails);
  const { name, user_id } = userProfile;
  const getLatestTweetsQuery = `SELECT
  u.username,
  t.tweet,
  t.date_time as dateTime
  FROM 
  user AS u INNER JOIN tweet AS t
  ON u.user_id=t.user_id
  WHERE u.user_id IN 
  (SELECT 
    following_user_id 
    FROM 
    follower 
    WHERE follower_user_id=${user_id})
  ORDER BY dateTime DESC 
  limit 4;`;
  const followingTweets = await db.all(getLatestTweetsQuery);
  response.send(followingTweets);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserDetails = `SELECT * FROM user WHERE username='${username}';`;
  const userProfile = await db.get(getUserDetails);
  const { name, user_id } = userProfile;
  const getFollowingUserQuery = `SELECT
  user.name
  FROM user 
  WHERE user.user_id IN 
  (SELECT 
    following_user_id 
    FROM 
    follower 
    WHERE 
    follower_user_id=${user_id});`;
  const userNames = await db.all(getFollowingUserQuery);
  response.send(userNames);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserDetails = `SELECT * FROM user WHERE username='${username}';`;
  const userProfile = await db.get(getUserDetails);
  const { name, user_id } = userProfile;
  const getFollowerQuery = `SELECT 
  user.name 
  FROM user 
  WHERE user.user_id IN 
  (SELECT 
    follower_user_id 
    FROM 
    follower WHERE 
    following_user_id=${user_id});`;
  const followerNames = await db.all(getFollowerQuery);
  response.send(followerNames);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  let { username } = request;
  const { tweetId } = request.params;
  const getTweetsQuery = `SELECT 
    user_id 
    FROM 
    tweet 
    WHERE tweet_id=${tweetId} AND user_id IN (SELECT 
        follower.following_user_id 
        FROM 
        user INNER JOIN follower ON user.user_id= follower.follower_user_id 
        WHERE user.username='${username}');`;
  const userId = await db.get(getTweetsQuery);
  if (userId === undefined) {
    response.status(401);
    response.send("Invalid Request");
    console.log("Invalid Request");
  } else {
    const getTweetLikesQuery = `SELECT 
      T.tweet,
      COUNT(T.like_id) AS likes,
      COUNT(reply.reply_id) AS replies,
      tweet.date_time AS dateTime
      FROM 
      (tweet LEFT JOIN like 
      ON tweet.tweet_id=like.tweet_id)AS T 
      LEFT JOIN reply ON tweet.tweet_id=reply.tweet_id
      WHERE T.tweet_id=${tweetId}
      ;`;
    const tweetDetails = await db.get(getTweetLikesQuery);
    response.send(tweetDetails);
  }
});

const createListAndPushToList = (userNames) => {
  const likes = [];
  for (let eachname of userNames) {
    let { username } = eachname;
    likes.push(username);
  }
  return { likes };
};

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    let { username } = request;
    const { tweetId } = request.params;
    const getTweetsQuery = `SELECT 
    user_id 
    FROM 
    tweet 
    WHERE tweet_id=${tweetId} AND user_id IN (SELECT 
        follower.following_user_id 
        FROM 
        user INNER JOIN follower ON user.user_id= follower.follower_user_id 
        WHERE user.username='${username}');`;
    const userId = await db.get(getTweetsQuery);
    if (userId === undefined) {
      response.status(401);
      response.send("Invalid Request");
      console.log("Invalid Request");
    } else {
      const getUserLikedQuery = `SELECT 
    user.username FROM 
    (tweet INNER JOIN like ON tweet.tweet_id=like.tweet_id) AS T 
    INNER JOIN user ON user.user_id=like.user_id 
    WHERE tweet.tweet_id=${tweetId};`;
      const userNames = await db.all(getUserLikedQuery);
      const nameObject = createListAndPushToList(userNames);
      response.send(nameObject);
    }
  }
);

const createListAndPushObjectToList = (replyObject) => {
  const replies = [];
  for (let eachObj of replyObject) {
    replies.push(eachObj);
  }
  return { replies };
};

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    let { username } = request;
    const { tweetId } = request.params;
    const getTweetsQuery = `SELECT 
    user_id 
    FROM 
    tweet 
    WHERE tweet_id=${tweetId} AND user_id IN (SELECT 
        follower.following_user_id 
        FROM 
        user INNER JOIN follower ON user.user_id= follower.follower_user_id 
        WHERE user.username='${username}');`;
    const userId = await db.get(getTweetsQuery);
    if (userId === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getUserReplayQuery = `
      SELECT 
      user.name,
      reply.reply
      FROM (tweet INNER JOIN reply ON tweet.tweet_id=reply.tweet_id) AS T 
      INNER JOIN user ON reply.user_id=user.user_id
      WHERE tweet.tweet_id=${tweetId} 
      GROUP BY user.user_id;`;
      const userReplys = await db.all(getUserReplayQuery);
      const objectArray = createListAndPushObjectToList(userReplys);
      response.send(objectArray);
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserDetails = `SELECT * FROM user WHERE username='${username}';`;
  const userProfile = await db.get(getUserDetails);
  const { name, user_id } = userProfile;
  const getUserTweetsQuery = `SELECT 
  tweet.tweet,
  COUNT(like.like_id) AS likes,
  COUNT(reply.reply) AS replies,
  tweet.date_time AS dateTime
  FROM 
  (tweet LEFT JOIN like ON tweet.user_id=like.user_id)AS T 
  LEFT JOIN reply ON T.user_id=reply.user_id 
  WHERE T.user_id=${user_id}
  GROUP BY T.tweet_id;`;
  const userTweet = await db.all(getUserTweetsQuery);
  response.send(userTweet);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  let { username } = request;
  const { tweet } = request.body;
  const getUserDetails = `SELECT * FROM user WHERE username='${username}';`;
  const userProfile = await db.get(getUserDetails);
  const { name, user_id } = userProfile;
  let date_time;
  const insertQuery = `INSERT INTO tweet(tweet,user_id) 
  VALUES('${tweet}',${user_id})`;
  await db.run(insertQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserQuery = `SELECT user_id FROM tweet 
    WHERE tweet_id=${tweetId} AND user_id = (SELECT user_id FROM user WHERE username='${username}');`;
    const userId = await db.get(getUserQuery);
    if (userId === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id=${tweetId};`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;