import React, { useEffect, useState } from 'react';
import { ensureAbsoluteImageUrl } from '@utils/imageUtils';
import { useAuthedImageSrc } from '@hooks/useAuthedImageSrc';

interface UserAvatarProps {
  name?: string | null;
  imageUrl?: string | null;
  /** Size classes for the circle, e.g. "w-10 h-10". */
  className?: string;
}

const initialsOf = (name?: string | null): string => {
  const words = (name || '').replace(/^(dr|mr|mrs|ms|mdm|prof)\.?\s+/i, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
};

/**
 * Round profile photo with the brand ring. Falls back to the person's initials
 * when there is no photo or it cannot be loaded — never a broken image.
 */
const UserAvatar: React.FC<UserAvatarProps> = ({ name, imageUrl, className = 'w-10 h-10' }) => {
  const { src, failed } = useAuthedImageSrc(ensureAbsoluteImageUrl(imageUrl));
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);

  const showImage = !!src && !failed && !broken;
  return (
    <span className={`avatar ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name || 'Profile photo'} className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span aria-label={name || undefined}>{initialsOf(name) || '?'}</span>
      )}
    </span>
  );
};

export default UserAvatar;
