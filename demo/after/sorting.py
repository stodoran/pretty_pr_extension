"""Toy sorting algorithms (demo fixture)."""


def insertion_sort(items):
    items = list(items)
    for i in range(1, len(items)):
        key = items[i]
        j = i - 1
        while j >= 0 and items[j] > key:
            items[j + 1] = items[j]
            j -= 1
        items[j + 1] = key
    return items


def log_sorted(items, verbose):
    if verbose:
        print("sorting", len(items), "items")
    print("done")
    return sorted(items)


def merge(left, right):
    out = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            out.append(left[i])
            i += 1
        else:
            out.append(right[j])
            j += 1
    return out + left[i:] + right[j:]


def merge_sort(items):
    if len(items) <= 1:
        return list(items)
    mid = len(items) // 2
    return merge(merge_sort(items[:mid]), merge_sort(items[mid:]))


def compute_stats(items, name, size):
    return {"name": name, "size": size, "min": min(items), "max": max(items)}


def format_summary(stats, verb):
    return "%s %s: %d items" % (stats["name"], verb, stats["size"])


def sort_report(items, algorithm):
    result = algorithm(items)
    stats, name = compute_stats(
        items,
        algorithm.__name__,
        len(items),
    ), "sorted"
    summary = format_summary(stats, name)
    print(summary)
    return result


def sort_bubble(items):
    items = list(items)
    n = len(items)
    for i in range(n):
        for j in range(n - i - 1):
            if items[j] > items[j + 1]:
                items[j], items[j + 1] = items[j + 1], items[j]
    return items
