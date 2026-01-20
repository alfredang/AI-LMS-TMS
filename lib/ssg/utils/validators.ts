/**
 * Validation utilities for SSG API
 * Converted from Python verify.py
 */

export class Validators {
  // NRIC validation constants
  private static readonly NRIC_PRODUCT = [2, 7, 6, 5, 4, 3, 2];
  private static readonly S_T_CHECKDIGIT = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "Z", "J"];
  private static readonly G_F_CHECKDIGIT = ["K", "L", "M", "N", "P", "Q", "R", "T", "U", "W", "X"];
  private static readonly M_CHECKDIGIT = ["K", "L", "J", "N", "P", "Q", "R", "T", "U", "W", "X"];

  /**
   * Verifies if the UEN provided is preliminarily valid.
   * This does not check if a UEN is actually valid (attached to a valid entity in Singapore).
   * 
   * Algorithm inspired by https://www.uen.gov.sg/ueninternet/faces/pages/admin/aboutUEN.jspx
   * 
   * UEN Formats:
   * 1. Businesses registered with ACRA: DDDDDDDDX
   * 2. Local Companies registered with ACRA: YYYYDDDDDX  
   * 3. Others: TYYXEDDDDX
   */
  static verifyUEN(uen: string): boolean {
    if (typeof uen !== 'string') {
      throw new Error('UEN must be a string!');
    }

    if (uen.length !== 9 && uen.length !== 10) {
      return false;
    }

    if (uen.length === 9) {
      return /^[0-9]{8}[A-Z]{1}$/.test(uen);
    }

    if (uen.length === 10) {
      const match1 = /^[0-9]{9}[A-Z]{1}$/.test(uen);
      const match2 = /^T[0-9]{2}(CC|CD|CH|CL|CM|CP|CS|CX|DP|FB|FC|FM|FN|GA|GB|GS|HC|HS|LL|LP|MB|MC|MD|MH|MM|MQ|NB|NR|PA|PB|PF|RF|RP|SM|SS|TC|TU|VH|XL)[0-9]{4}[A-Z]{1}$/.test(uen);
      
      return match1 || match2;
    }

    return false;
  }

  /**
   * Verifies if the AES-256 key is valid (256 bit / 32 bytes long).
   * Based on base64 encoding length calculation.
   */
  static verifyAESEncryptionKey(key: string): boolean {
    if (typeof key !== 'string') {
      throw new Error('Key must be a string!');
    }

    if (!key || key.length === 0) {
      return false;
    }

    const lenKey = key.length;
    let count = 0;

    if (lenKey > 1 && key[lenKey - 2] === '=') {
      count -= 1;
    }

    if (lenKey > 0 && key[lenKey - 1] === '=') {
      count -= 1;
    }

    count += Math.floor((key.length * 3) / 4);

    return count === 32;
  }

  /**
   * Validates NRIC/FIN numbers according to Singapore's algorithm
   */
  static verifyNRIC(nric: string): boolean {
    if (typeof nric !== 'string') {
      throw new Error('NRIC must be a string!');
    }

    if (nric.length !== 9) {
      return false;
    }

    const firstChar = nric[0].toUpperCase();
    const lastChar = nric[8].toUpperCase();
    const middleDigits = nric.substring(1, 8);

    // Check if middle 7 characters are digits
    if (!/^\d{7}$/.test(middleDigits)) {
      return false;
    }

    // Check first character
    if (!['S', 'T', 'F', 'G', 'M'].includes(firstChar)) {
      return false;
    }

    // Calculate checksum
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      sum += parseInt(middleDigits[i]) * Validators.NRIC_PRODUCT[i];
    }

    let checkDigits: string[];
    if (['S', 'T'].includes(firstChar)) {
      checkDigits = Validators.S_T_CHECKDIGIT;
    } else if (['F', 'G'].includes(firstChar)) {
      checkDigits = Validators.G_F_CHECKDIGIT;
    } else if (firstChar === 'M') {
      checkDigits = Validators.M_CHECKDIGIT;
    } else {
      return false;
    }

    const expectedCheckDigit = checkDigits[sum % 11];
    return expectedCheckDigit === lastChar;
  }

  /**
   * Validates email format
   */
  static verifyEmail(email: string): boolean {
    if (typeof email !== 'string') {
      throw new Error('Email must be a string!');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validates postal code (Singapore format)
   */
  static verifyPostalCode(postalCode: string): boolean {
    if (typeof postalCode !== 'string') {
      throw new Error('Postal code must be a string!');
    }

    // Singapore postal codes are 6 digits
    return /^\d{6}$/.test(postalCode);
  }

  /**
   * Validates phone number (Singapore format)
   */
  static verifyPhoneNumber(phoneNumber: string): boolean {
    if (typeof phoneNumber !== 'string') {
      throw new Error('Phone number must be a string!');
    }

    // Remove spaces and dashes
    const cleaned = phoneNumber.replace(/[\s-]/g, '');
    
    // Singapore phone number patterns
    const patterns = [
      /^(\+65)?[689]\d{7}$/, // Mobile numbers
      /^(\+65)?[36]\d{7}$/,  // Fixed line numbers
      /^(\+65)?1[89]\d{2}$/  // Toll-free numbers
    ];

    return patterns.some(pattern => pattern.test(cleaned));
  }

  /**
   * Validates date string in YYYYMMDD format
   */
  static verifyDateYYYYMMDD(dateStr: string): boolean {
    if (typeof dateStr !== 'string') {
      throw new Error('Date must be a string!');
    }

    if (!/^\d{8}$/.test(dateStr)) {
      return false;
    }

    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6));
    const day = parseInt(dateStr.substring(6, 8));

    // Basic range checks
    if (year < 1900 || year > 2100) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    // Create date and verify it's valid
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && 
           date.getMonth() === month - 1 && 
           date.getDate() === day;
  }

  /**
   * Validates time string in HH:mm or HH:mm:ss format
   */
  static verifyTime(timeStr: string): boolean {
    if (typeof timeStr !== 'string') {
      throw new Error('Time must be a string!');
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;
    return timeRegex.test(timeStr);
  }

  /**
   * Validates URL format
   */
  static verifyURL(url: string): boolean {
    if (typeof url !== 'string') {
      throw new Error('URL must be a string!');
    }

    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validates base64 encoded string
   */
  static verifyBase64(str: string): boolean {
    if (typeof str !== 'string') {
      throw new Error('Input must be a string!');
    }

    try {
      return btoa(atob(str)) === str;
    } catch {
      return false;
    }
  }

  /**
   * Validates if a string contains only alphanumeric characters
   */
  static verifyAlphanumeric(str: string): boolean {
    if (typeof str !== 'string') {
      throw new Error('Input must be a string!');
    }

    return /^[a-zA-Z0-9]+$/.test(str);
  }

  /**
   * Validates if a number is within a specified range
   */
  static verifyNumberRange(num: number, min: number, max: number): boolean {
    if (typeof num !== 'number' || typeof min !== 'number' || typeof max !== 'number') {
      throw new Error('All inputs must be numbers!');
    }

    return num >= min && num <= max;
  }

  /**
   * Validates if a string length is within specified bounds
   */
  static verifyStringLength(str: string, minLength: number, maxLength: number): boolean {
    if (typeof str !== 'string') {
      throw new Error('Input must be a string!');
    }

    if (typeof minLength !== 'number' || typeof maxLength !== 'number') {
      throw new Error('Length bounds must be numbers!');
    }

    return str.length >= minLength && str.length <= maxLength;
  }
}

// Specific validation functions for SSG API fields
export class SSGValidators extends Validators {
  /**
   * Validates course reference number format
   */
  static validateCourseReferenceNumber(courseRefNum: string): boolean {
    if (!courseRefNum || typeof courseRefNum !== 'string') {
      return false;
    }

    // Basic format validation - adjust based on actual SSG requirements
    return courseRefNum.length > 0 && courseRefNum.length <= 100;
  }

  /**
   * Validates trainer ID format
   */
  static validateTrainerID(trainerId: string): boolean {
    if (!trainerId || typeof trainerId !== 'string') {
      return false;
    }

    return this.verifyAlphanumeric(trainerId) && this.verifyStringLength(trainerId, 1, 50);
  }

  /**
   * Validates session ID format
   */
  static validateSessionID(sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string') {
      return false;
    }

    return this.verifyStringLength(sessionId, 1, 300);
  }

  /**
   * Validates intake size
   */
  static validateIntakeSize(intakeSize: number): boolean {
    return typeof intakeSize === 'number' && intakeSize > 0 && intakeSize <= 10000;
  }

  /**
   * Validates sequence number
   */
  static validateSequenceNumber(sequenceNumber: number): boolean {
    return typeof sequenceNumber === 'number' && sequenceNumber > 0;
  }
}