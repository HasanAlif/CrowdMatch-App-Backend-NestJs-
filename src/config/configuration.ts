export default () => {
  return {
    port: parseInt(process.env.PORT ?? '8000', 10),
    databaseUrl: process.env.DATABASE_URL,

    jwt: {
      secret: process.env.JWT_SECRET_KEY,
      expiresIn: process.env.JWT_EXPIRES_IN,
      otpSecret: process.env.JWT_OTP_SECRET,
      otpExpiresIn: process.env.JWT_OTP_EXPIRES_IN,
    },

    otp: {
      expiresInMinutes: parseInt(process.env.OTP_EXPIRES_IN_MINUTES ?? '5', 10),
    },

    mail: {
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT ?? '587', 10),
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
      from: process.env.MAIL_FROM,
    },

    admin: {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    },

    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
    },

    google: {
      webClientId: process.env.GOOGLE_WEB_CLIENT_ID,
    },

    apple: {
      bundleId: process.env.APPLE_BUNDLE_ID,
    },

    smsto: {
      apiKey: process.env.SMS_TO_API_KEY,
      senderId: process.env.SMS_TO_SENDER_ID,
    },
  };
};
