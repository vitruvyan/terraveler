import oculus, time
places = ["Plymouth","Rio de Janeiro","Tierra del Fuego","Tahiti","Botany Bay",
          "Batavia","Cape Town","New Zealand","Endeavour River","Great Barrier Reef"]
for p in places:
    g = oculus.geocode(p); time.sleep(1)
    if g:
        print("%-19s -> %8.3f, %9.3f  [%s]  (%s)" % (p, g["lat"], g["lng"], g["provenance"], g["matched"][:34]))
    else:
        print("%-19s -> UNANCHORED (would force reconstructed)" % p)
