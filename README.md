# Geeks S3 API Upload Tool

A powerful, entirely client-side web application to upload files and entire folder structures directly from your browser to Cloudflare R2 or any AWS S3 Compatible storage. 

✨ **Features**
- 🚀 **Bypasses Browser Upload Limits**: Uses `@aws-sdk/lib-storage` Multipart Uploads to break massive files into small 10MB chunks automatically.
- 📁 **Folder Drag & Drop**: Recursively reads deep directory structures on Drag & Drop and maintains the path in the S3 Bucket.
- 🔐 **Secure & Serverless**: 100% Client-side. It connects directly to the S3 API without an intermediate server. Credentials stay in your local browser cache ONLY.
- 💅 **Premium Design**: Dark mode and glassmorphism styling built from scratch.

## Deployment with Vercel

This repository is built using React, TypeScript, and Vite, making it extremely easy to deploy directly to Vercel.

1. Create a GitHub repository and push this code.
2. Go to [Vercel](https://vercel.com).
3. Click on **Add New...** -> **Project**.
4. Import your newly created GitHub repository.
5. Vercel will automatically detect that it's a **Vite** project. 
6. Leave the Build Command as `npm run build` and Output Directory as `dist`.
7. Click **Deploy**.

In less than a minute, you'll have a public URL for your tool!

## VERY IMPORTANT: Cloudflare R2 CORS Configuration
Since this app runs from a browser, your S3 Provider (e.g., Cloudflare R2) will block the uploads via CORS by default unless you explicitly allow them.

If you deploy this tool, you **MUST** go to your Cloudflare R2 Dashboard -> Select Bucket -> Settings -> **CORS Policy** and paste this exact JSON (Edit the origin with your public Vercel domain if you prefer to be strict):

```json
[
  {
    "AllowedOrigins": [
      "*"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "POST",
      "DELETE",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 3000
  }
]
```

## Running Locally

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```
