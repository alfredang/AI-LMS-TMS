import React, { useState } from 'react';
import { getFileUrl } from '@/lib/urlHelpers';

interface CourseImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackSeed: string;
  width?: number;
  height?: number;
}

export const CourseImage: React.FC<CourseImageProps> = ({ 
  src, 
  alt, 
  className = '', 
  fallbackSeed,
  width = 400,
  height = 200
}) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const getImageSrc = (imageSrc?: string): string => {
    if (!imageSrc || hasError) {
      return `https://picsum.photos/seed/${fallbackSeed}/${width}/${height}`;
    }

    // If it's already a full URL (http/https), use it as-is
    if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
      return imageSrc;
    }

    // If it starts with /uploads, it's a local file - prepend the server URL
    if (imageSrc.startsWith('/uploads/')) {
      return getFileUrl(imageSrc) || imageSrc;
    }

    // If it's a blob URL or any other format, fall back to placeholder
    if (imageSrc.startsWith('blob:')) {
      setHasError(true);
      return `https://picsum.photos/seed/${fallbackSeed}/${width}/${height}`;
    }

    return imageSrc;
  };

  const handleError = () => {
    setHasError(true);
    setIsLoading(false);
  };

  const handleLoad = () => {
    setIsLoading(false);
  };

  return (
    <div className={`relative ${className}`}>
      <img
        src={getImageSrc(src)}
        alt={alt}
        className={`transition-opacity duration-300 ${isLoading ? 'opacity-50' : 'opacity-100'} ${className}`}
        onError={handleError}
        onLoad={handleLoad}
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
        </div>
      )}
    </div>
  );
};