import type React from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
  zIndex?: number;
  side?: 'left' | 'right';
  backdropClassName?: string;
  showCloseButton?: boolean;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
  width,
  side = 'right',
  zIndex,
  backdropClassName,
  showCloseButton = true,
}) => {
  void zIndex;
  void backdropClassName;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={side}
        showCloseButton={showCloseButton}
        className={cn('w-full overflow-y-auto', width ?? 'sm:max-w-xl')}
      >
        {title ? (
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">{title}</SheetDescription>
          </SheetHeader>
        ) : null}
        <div className="min-h-0 flex-1 p-4 pt-0">{children}</div>
      </SheetContent>
    </Sheet>
  );
};
