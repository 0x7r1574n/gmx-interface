import { useEffect } from "react";
import { toast } from "react-toastify";

import { TOAST_AUTO_CLOSE_TIME } from "config/ui";

export const useToastAutoClose = (isCompleted: boolean, toastTimestamp: number) => {
  useEffect(
    function autoClose() {
      let timerId;

      if (isCompleted) {
        timerId = setTimeout(() => {
          toast.dismiss(toastTimestamp);
        }, TOAST_AUTO_CLOSE_TIME);
      }

      return () => {
        clearTimeout(timerId);
      };
    },
    [isCompleted, toastTimestamp]
  );
};
