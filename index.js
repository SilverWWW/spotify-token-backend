import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  res.send('Server is running');
});

// token swap
app.post('/api/token', async (req, res) => {
    console.log('attempting token swap', req)
  try {
    const authorizationCode = req.body.code; // get "code"

    if (!authorizationCode) {
      return res.status(400).json({ error: 'No auth code' });
    }

    // exchange code with spotify
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI
      })
    });

    const tokenData = await tokenResponse.json();

    // example response from Spotify:
    // {
    //   access_token: 'x',
    //   refresh_token: 'x',
    //   expires_in: 3600,
    //   token_type: 'Bearer'
    // }

    if (tokenData.error) {
      return res.status(400).json({ error: tokenData.error, description: tokenData.error_description });
    }

    // return tokens
    res.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in
    });
  } catch (err) {
    console.error('Token swap error:', err);
    res.status(500).json({ error: 'Server error during token swap' });``
  }
});

// token refresh endpoint
app.post('/api/refresh', async (req, res) => {
    console.log('attempting token refresh', req)
  try {
    const refreshToken = req.body.refresh_token;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh_token' });
    }

    // get new token from spotify
    const refreshResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });

    const refreshData = await refreshResponse.json();

    if (refreshData.error) {
      return res.status(400).json({ error: refreshData.error, description: refreshData.error_description });
    }

    // return new access token
    res.json({
      access_token: refreshData.access_token,
      expires_in: refreshData.expires_in
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Server error during token refresh' });
  }
});

// listen 
app.listen(port, '0.0.0.0', () => {
  console.log(`Spotify token server listening on port ${port}`);
});
