export const hasMetricsChanged = (oldData, newData) => {
  if (!oldData) return true;

  return Object.keys(newData).some(
    (key) => oldData[key] !== newData[key]
  );
};
