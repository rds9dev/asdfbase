module.exports = {
  apps: [
    {
      name: 'asdfbase-backend',
      script: 'dist/index.js',
      cwd: '/home/rds9/services/asdfbase/backend',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '250M',
      env: {
        NODE_ENV: 'production',
        PORT: '8091',
        DATABASE_URL: 'postgresql://asdfbase:asdfbase_secure_password_2026@127.0.0.1:5432/asdfbase',
        JWT_SECRET: 'asdfbase_jwt_super_secret_key_2026_x89q',
        INVITE_CODE: 'ASDF'
      }
    }
  ]
};
