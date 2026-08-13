import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UserService } from '../user/user.service';
import { Role } from '../user/user.types';
import * as bcrypt from 'bcrypt';
import * as dns from 'dns';
import configuration from 'src/config/configuration';

if (process.env.USE_GOOGLE_DNS === 'true') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

async function bootstrap() {
  console.log('Initializing application context...');
  const app = await NestFactory.createApplicationContext(AppModule);

  const userService = app.get(UserService);

  // Change these to your preferred default admin credentials
  const adminEmail = configuration().admin.email;
  const adminPassword = configuration().admin.password;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'ADMIN_EMAIL or ADMIN_PASSWORD is not set in environment variables',
    );
  }

  console.log(`Checking if admin user exists (${adminEmail})...`);
  const existingAdmin = await userService.findByEmail(adminEmail);

  if (existingAdmin) {
    console.log('Admin user already exists!');
    await app.close();
    return;
  }

  console.log('Creating admin user...');
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  await userService.createUser({
    fullName: 'SwapMess Admin',
    email: adminEmail,
    password: hashedPassword,
    role: Role.Admin,
    isVerified: true, // Auto-verify the admin account
    isActive: true,
  });

  console.log('Admin user seeded successfully!');
  await app.close();
}

bootstrap().catch((err) => {
  console.error('Failed to seed admin user', err);
  process.exit(1);
});

// RUN: npm run seed:admin
