import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

let cachedToken = null;
let tokenExpirationTime = null;

app.use(bodyParser.urlencoded({ extended: false }));

// client credential token acquisition
async function getClientCredentialsToken() {
  if (cachedToken && Date.now() < tokenExpirationTime) {
    console.log("got a cached token: ", cachedToken)
    return cachedToken;
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.log("error fetching new cc token: ", data.error_description)
    throw new Error(`failed to fetch token: ${data.error_description}`);
  }

  cachedToken = data.access_token;
  tokenExpirationTime = Date.now() + data.expires_in * 1000;

  console.log("returning new cc token: ", cachedToken)
  return cachedToken;
}

// health check
app.get('/', (req, res) => {
  res.send('Server is running');
});

// token swap
app.post('/api/token', async (req, res) => {
  console.log('attempting token swap')
  try {
    const authorizationCode = req.body.code; // get "code"

    if (!authorizationCode) {
        console.log("no auth code")
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
      console.log("token data error", error)
      return res.status(400).json({ error: tokenData.error, description: tokenData.error_description });
    }

    console.log("returning token data")
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
    console.log("returning refresh access token")
    res.json({
      access_token: refreshData.access_token,
      expires_in: refreshData.expires_in
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Server error during token refresh' });
  }
});

// get song bpm
// DEPRECATED SPOTIFY ENDPOINT
app.get('/api/song/:id/bpm', async (req, res) => {
  console.log('getting bpm for: ', req.params.id);

  try {
    const songId = req.params.id;

    if (!songId) {
      return res.status(400).json({ error: 'Song ID is required' });
    }    

    const accessToken = await getClientCredentialsToken()

    const response = await fetch(`https://api.spotify.com/v1/audio-features/${songId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.log("Error", errorData.error, errorData.error.message)
      return res.status(response.status).json({ error: errorData.error, message: errorData.error.message });
    }

    const audioFeatures = await response.json();
    res.json({ bpm: audioFeatures.tempo });
  } catch (err) {
    console.error('Error fetching BPM:', err);
    res.status(500).json({ error: 'Server error while fetching BPM' });
  }
});

// get user playlists
app.get('/api/user/playlists', async (req, res) => {
  console.log('getting user playlists');

  try {
    const accessToken = req.headers.authorization?.split(' ')[1];

    if (!accessToken) {
      return res.status(401).json({ error: 'Missing or invalid access token' });
    }

    const response = await fetch('https://api.spotify.com/v1/me/playlists', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).json({ error: errorData.error, message: errorData.error.message });
    }

    const playlists = await response.json();
    res.json(playlists);
  } catch (err) {
    console.error('err fetching playlists:', err);
    res.status(500).json({ error: 'Server err while fetching playlists' });
  }
});

// get playlist songs
app.get('/api/playlist/:id/songs', async (req, res) => {
  console.log('Fetching songs for playlist:', req.params.id);

  try {
    const playlistId = req.params.id;
    const accessToken = req.headers.authorization?.split(' ')[1];

    if (!accessToken) {
      return res.status(401).json({ error: 'Missing or invalid access token' });
    }

    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).json({ error: errorData.error, message: errorData.error.message });
    }

    const playlistTracks = await response.json();
    res.json(playlistTracks);
  } catch (err) {
    console.error('err fetching playlist songs:', err);
    res.status(500).json({ error: 'Server err while fetching playlist songs' });
  }
});

// listen 
app.listen(port, '0.0.0.0', () => {
  console.log(`Spotify token server listening on port ${port}`);
});
