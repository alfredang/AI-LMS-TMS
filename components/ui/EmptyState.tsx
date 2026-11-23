import React from 'react';
import { Icon, IconName } from './Icon';
import { Button } from './Button';

interface EmptyStateProps {
    icon?: IconName;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    icon = IconName.Courses,
    title,
    description,
    actionLabel,
    onAction,
    className = ''
}) => {
    return (
        <div className={`flex flex-col items-center justify-center p-12 text-center bg-surface-elevated rounded-lg border-2 border-dashed border-default ${className}`}>
            <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center shadow-sm mb-4">
                <Icon name={icon} className="w-8 h-8 text-muted" />
            </div>
            <h3 className="text-lg font-medium text-on-surface mb-1">{title}</h3>
            {description && (
                <p className="text-muted max-w-sm mb-6">{description}</p>
            )}
            {actionLabel && onAction && (
                <Button onClick={onAction} variant="primary">
                    {actionLabel}
                </Button>
            )}
        </div>
    );
};
