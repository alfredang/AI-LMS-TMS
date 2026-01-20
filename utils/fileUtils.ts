/**
 * Extract the original filename from a timestamped filename
 * Input: "1234567890-document.pdf" 
 * Output: "document.pdf"
 */
export const extractOriginalFilename = (fullFilename: string): string => {
  if (!fullFilename) return '';
  
  // Find the first dash that separates timestamp from original filename
  const dashIndex = fullFilename.indexOf('-');
  if (dashIndex === -1) {
    // No dash found, return the full filename (fallback)
    return fullFilename;
  }
  
  // Return everything after the first dash
  return fullFilename.substring(dashIndex + 1);
};

/**
 * Extract the original filename from a file URL path
 * Input: "/uploads/plans/1234567890-document.pdf"
 * Output: "document.pdf"
 */
export const extractFilenameFromPath = (filePath: string): string => {
  if (!filePath) return '';
  
  // Get the filename from the path
  const filename = filePath.split('/').pop() || '';
  
  // Extract original name from timestamped filename
  return extractOriginalFilename(filename);
};