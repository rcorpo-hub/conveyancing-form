import dotenv from 'dotenv';
dotenv.config();

const baseEmail = process.env.SMTP_USER || 'appointment.rcorp@gmail.com';
const [userPart, domainPart] = baseEmail.includes('@') ? baseEmail.split('@') : ['client', 'rcorpo.com'];

/** The three test people / firm addresses supplied for testing. */
export const TEST_EMAILS = {
  purchaser1: process.env.TEST_CLIENT_EMAIL || `${userPart}+client1@${domainPart}`,
  purchaser2: process.env.TEST_CLIENT_EMAIL_2 || `${userPart}+client2@${domainPart}`,
  firm: process.env.FIRM_EMAIL?.split(',')[0]?.trim() || baseEmail
};

