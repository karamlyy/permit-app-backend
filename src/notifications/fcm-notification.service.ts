import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import { User } from '../users/user.entity';

@Injectable()
export class FcmNotificationService implements OnModuleInit {
  private readonly logger = new Logger(FcmNotificationService.name);
  private firebaseApp: admin.app.App | null = null;

  onModuleInit() {
    try {
      let credential: admin.credential.Credential;

      // Variant 1: Environment variable-dan JSON string (production üçün)
      if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
          credential = admin.credential.cert(serviceAccount);
          this.logger.log('Firebase Admin SDK initialized from environment variable');
        } catch (parseError) {
          throw new Error(
            `Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${parseError.message}`,
          );
        }
      } else {
        // Variant 2: JSON faylından (development üçün)
        const serviceAccountPath =
          process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
          path.join(process.cwd(), 'config', 'firebase-service-account.json');

        credential = admin.credential.cert(serviceAccountPath);
        this.logger.log(
          `Firebase Admin SDK initialized from file: ${serviceAccountPath}`,
        );
      }

      // Firebase Admin SDK-nı initialize et
      this.firebaseApp = admin.initializeApp({
        credential,
      });

      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error(
        `Failed to initialize Firebase Admin SDK: ${error.message}`,
        error.stack,
      );
      this.logger.warn(
        'FCM notifications will not work until Firebase is properly configured.',
      );
    }
  }

  async sendToToken(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase Admin SDK not initialized, skipping notification');
      return;
    }

    if (!token || token.trim() === '') {
      this.logger.warn('FCM token is empty, skipping notification');
      return;
    }

    try {
      const message: admin.messaging.Message = {
        token,
        notification: {
          title,
          body,
        },
        data: data
          ? Object.keys(data).reduce((acc, key) => {
              acc[key] = String(data[key]);
              return acc;
            }, {} as Record<string, string>)
          : undefined,
        android: {
          priority: 'high' as const,
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
        },
      };

      const response = await admin.messaging().send(message);
      this.logger.debug(`FCM notification sent successfully: ${response}`);
    } catch (error) {
      // Firebase error handling
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        this.logger.warn(
          `Invalid or unregistered FCM token: ${token.substring(0, 20)}...`,
        );
      } else {
        this.logger.warn(
          `Error sending FCM notification: ${error.message}`,
          error.stack,
        );
      }
    }
  }

  async sendToUser(
    user: User,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!user.fcmToken || user.fcmToken.trim() === '') {
      this.logger.debug(
        `User ${user.id} (${user.email}) does not have FCM token, skipping notification`,
      );
      return;
    }

    await this.sendToToken(user.fcmToken, title, body, data);
  }
}

