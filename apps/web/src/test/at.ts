/** The item a test expects at `index`; fails the test instead of yielding `undefined`. */
export function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`Expected an item at index ${index}.`);
  return item;
}
