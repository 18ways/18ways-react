import React, { useEffect } from 'react';

export const Style = ({ children }: { children: string }): React.JSX.Element => {
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = children;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, [children]);

  return <></>;
};
