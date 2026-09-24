import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { ImportModule } from './import/import.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { KioskModule } from './kiosk/kiosk.module.js';
import { ReferenceDataModule } from './reference-data/reference-data.module.js';
import { MailerModule } from './mailer/mailer.module.js';
import { SecretsModule } from './secrets/secrets.module.js';
import { PipelineModule } from './pipeline/pipeline.module.js';
import { FormsModule } from './forms/forms.module.js';
import { UploadModule } from './upload/upload.module.js';
import { ProductionEngineModule } from './production-engine/production-engine.module.js';
import { PurchasingModule } from './purchasing/purchasing.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { SessionAuthGuard } from './common/guards/session-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SecretsModule,
    ReferenceDataModule,
    MailerModule,
    UploadModule,
    ProductionEngineModule,
    AuthModule,
    KioskModule,
    PipelineModule,
    FormsModule,
    PurchasingModule,
    DashboardModule,
    ImportModule,
  ],
  controllers: [AppController],
  providers: [
    // Order matters: session auth resolves req.user first, roles guard
    // reads it second. Both apply to every route by default — see
    // @Public()/@Roles() in src/common/decorators for the opt-in/opt-out.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
